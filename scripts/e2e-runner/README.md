# wxyc-e2e-runner

Provisioning runbook for the dedicated EC2 instance that hosts the self-hosted GitHub Actions runner used by the staging-gate E2E suites in Backend-Service, library-metadata-lookup, and dj-site.

Plan-of-record: [WXYC/wiki#80](https://github.com/WXYC/wiki/issues/80). This phase: [#165](https://github.com/WXYC/wxyc-shared/issues/165).

## Topology

| Item | Value |
|------|-------|
| AWS account | `203767826763` (the WXYC org AWS account; same as the Backend-Service EC2 box). SSO via `aws sso login --profile wxyc-api` |
| Region | `us-east-1` |
| Instance type | `t3.small` |
| OS | Ubuntu 24.04 LTS (noble) |
| Hostname | `wxyc-e2e-runner` |
| Instance ID | `i-0a7b538a69e2962bd` |
| Security group | `sg-0fe527fadc5a7a02a` (`wxyc-e2e-runner-sg`) |
| Keypair | `wxyc-e2e-runner` (private key at `~/.ssh/wxyc_e2e_runner`) |
| GHA runner label | `e2e-runner` |
| GHA runner scope | Organization (`WXYC`) |
| Estimated cost | ~$15/mo on-demand, ~$8/mo reserved (see [Cost](#cost) for the math) |

The runner shares an AWS account with the Backend-Service EC2 box (`i-0685e373989cd5daa`) but is a separate instance so that a wedge on either side does not take down the other. The runner box is stateless and disposable — if it dies, replace it from the AMI and re-run `bootstrap.sh`.

## Provisioning

### 1. Launch the instance

From AWS account `203767826763` (`aws sso login --profile wxyc-api`):

- AMI: latest Ubuntu 24.04 LTS for `x86_64` (Canonical owner `099720109477`, name `ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*`)
- Instance type: `t3.small`
- Subnet: any default public subnet in `us-east-1`
- Security group: SSH 22 from operator IP (`/32`) for provisioning + maintenance, egress all. The runner needs outbound 443 to reach `github.com`; `bootstrap.sh` additionally hits `download.docker.com`, `deb.nodesource.com`, `ppa.launchpad.net` (deadsnakes), `archive.ubuntu.com`, and `github.com/actions/runner/releases`. Leave egress 443 open to all destinations. If your threat model wants zero inbound after provisioning, drop SSH and re-add it before any re-bootstrap
- Key pair: `wxyc-e2e-runner` (ed25519). Private key on the operator workstation at `~/.ssh/wxyc_e2e_runner`
- IAM instance profile: none required for the runner itself (workflows that need AWS use repo-scoped OIDC)
- Storage: 20 GiB gp3
- Tag `Name=wxyc-e2e-runner`

### 1a. Org runner group must allow public repos

`wxyc-shared` is a public repo. GitHub blocks self-hosted runners from public-repo workflows by default. One-time org-level flip:

```bash
gh api -X PATCH /orgs/WXYC/actions/runner-groups/1 -F allows_public_repositories=true
```

Without this, jobs targeting `runs-on: [self-hosted, e2e-runner]` from a public repo stay queued indefinitely with no error surfaced on the runner side.

### 2. SSH and run the bootstrap

From the operator workstation:

```bash
RUNNER_IP=<public-ip>
scp -i ~/.ssh/wxyc_e2e_runner scripts/e2e-runner/bootstrap.sh ubuntu@"$RUNNER_IP":/tmp/bootstrap.sh
RUNNER_TOKEN=$(gh api -X POST /orgs/WXYC/actions/runners/registration-token --jq .token)
ssh -i ~/.ssh/wxyc_e2e_runner ubuntu@"$RUNNER_IP" \
  "sudo GHA_RUNNER_TOKEN='$RUNNER_TOKEN' GHA_RUNNER_URL=https://github.com/WXYC bash /tmp/bootstrap.sh"
```

Registration tokens are short-lived (~1h). Generate it on the operator side and pass through ssh so it never touches the runner's disk except in process env.

The bootstrap is idempotent. Re-running it after a partial failure resumes from the failed step.

### 3. Verify

On the box:

```bash
systemctl status 'actions.runner.*.service'
```

On GitHub: <https://github.com/organizations/WXYC/settings/actions/runners> should show `wxyc-e2e-runner` as **Idle** with label `e2e-runner`.

### 4. Smoke run

For phase 1 acceptance, drop the workflow below onto a scratch branch as `.github/workflows/e2e-runner-smoke.yml`, push to trigger it, then delete the branch once it's green. The workflow is intentionally not committed to `main` — it's a one-off acceptance probe, not retained tooling.

`workflow_dispatch` cannot be used until the workflow file exists on `main`, so the smoke workflow triggers on push to the scratch branch instead. The steps mirror `ci.yml` (setup-go → install oasdiff → npm ci → generate → build → lint → test) because the wxyc-shared test suite depends on `oasdiff` for breaking-change checks and on the generated TypeScript types for type-check.

```yaml
# Smoke workflow used only for phase 1 acceptance; not retained.
# Paste into .github/workflows/e2e-runner-smoke.yml on a scratch branch
# named `e2e-runner-smoke`; pushing triggers the run.
name: e2e-runner-smoke
on:
  push:
    branches: [e2e-runner-smoke]
jobs:
  smoke:
    runs-on: [self-hosted, e2e-runner]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Tooling versions
        run: |
          echo "== node =="; node --version
          echo "== npm =="; npm --version
          echo "== docker =="; docker --version
          echo "== python =="; python3.12 --version
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: Install oasdiff
        run: |
          go install github.com/oasdiff/oasdiff@latest
          echo "$HOME/go/bin" >> "$GITHUB_PATH"
      - name: npm ci
        run: npm ci --ignore-scripts
      - name: Generate TypeScript types
        run: npm run generate:typescript
      - name: Build
        run: npm run build
      - name: Type check
        run: npm run lint
      - name: unit tests
        run: npm test
```

A green run completes phase 1. After that, delete the scratch branch; the runner sits idle until phases 2/3/4 wire real gate workflows to it.

The smoke deliberately does not run `npm run test:e2e` — the E2E suite needs `E2E_TEST_DJ_EMAIL` / `E2E_TEST_DJ_PASSWORD` secrets that don't exist in the wxyc-shared repo or org scope yet. Provisioning those is part of phase 5 (gate-coordinator workflow needs them too).

## Operations

### Replacing the instance

The bootstrap script is the source-of-truth. To rebuild:

1. Terminate the old instance.
2. Launch a fresh Ubuntu 24.04 instance with the same SG + tag.
3. Re-run the bootstrap with a fresh registration token.
4. Remove the dead runner from <https://github.com/organizations/WXYC/settings/actions/runners> (GitHub auto-removes runners that have been *offline* for 14 days; a runner stuck in `Idle` polls successfully and is never auto-removed).

### Updating the runner agent

GitHub auto-updates the runner agent. To pin a version, set `RUNNER_VERSION` when invoking the bootstrap.

### Canary probe (separate ticket)

The runner liveness probe lives in [wxyc-canary](https://github.com/WXYC/wxyc-canary). It calls `GET /orgs/WXYC/actions/runners/<id>` every 5 min and alarms if `status != "online"` for ≥10 min. Implemented as part of phase 1 acceptance but tracked separately in the canary repo.

## Cost

t3.small on-demand in `us-east-1` is ~$0.0208/h ≈ $15/mo. A 1-year Standard Reserved Instance drops to ~$8/mo. EBS 20 GiB gp3 is ~$1.60/mo. Total ≤ $20/mo.

Cost-conscious-infra rule: do not scale this box up without confirming the workload requires it. If the E2E suites outgrow `t3.small`, prefer reversible levers (instance class bump, scheduled stop/start outside business hours) over permanent storage increases — EBS volumes can grow but cannot shrink.

## Security notes

- The SG allows SSH 22 from the operator IP at steady state plus egress all. The runner agent itself only needs outbound 443; inbound exists for maintenance access.
- The runner runs jobs as user `runner` with Docker group membership. Workflows that mount the Docker socket can break out of the user boundary — keep that in mind if you ever schedule untrusted workflows here (current scope is WXYC repos only, no public forks).
- Registration token is short-lived (~1h). Never commit it.
- Use org-level runners (not repo-level) so token grants are visible org-wide.
- The org default runner group is configured with `allows_public_repositories: true` (required for `wxyc-shared`). Fork PRs from public contributors still need first-time-contributor approval before workflows run, so this does not let arbitrary forks execute on the box — but if WXYC ever onboards a contributor with `write` who is not trusted, revisit this.
