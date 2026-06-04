# wxyc-e2e-runner

Provisioning runbook for the dedicated EC2 instance that hosts the self-hosted GitHub Actions runner used by the staging-gate E2E suites in Backend-Service, library-metadata-lookup, and dj-site.

Plan-of-record: [WXYC/wiki#80](https://github.com/WXYC/wiki/issues/80). This phase: [#165](https://github.com/WXYC/wxyc-shared/issues/165).

## Topology

| Item | Value |
|------|-------|
| AWS account | `503977661500` (Jake's personal AWS, same account as wxyc-canary) |
| Region | `us-east-1` |
| Instance type | `t3.small` |
| OS | Ubuntu 24.04 LTS (noble) |
| Hostname | `wxyc-e2e-runner` |
| GHA runner label | `e2e-runner` |
| GHA runner scope | Organization (`WXYC`) |
| Estimated cost | ~$15/mo on-demand, ~$5/mo reserved |

The runner is intentionally separate from the Backend-Service EC2 box (account `203767826763`, instance `i-0685e373989cd5daa`) so that a wedge on either side does not take down the other. The runner box is stateless and disposable — if it dies, replace it from the AMI and re-run `bootstrap.sh`.

## Provisioning

### 1. Launch the instance

Console or `aws ec2 run-instances` from the `wxyc-canary` AWS account (`503977661500`):

- AMI: latest Ubuntu 24.04 LTS for `x86_64`
- Instance type: `t3.small`
- Subnet: any public subnet in `us-east-1`
- Security group: outbound 443 only (runner polls GitHub over outbound HTTPS; no inbound required)
- Key pair: existing personal key
- IAM instance profile: none required for the runner itself (workflows that need AWS use repo-scoped OIDC)
- Storage: 20 GiB gp3
- Tag `Name=wxyc-e2e-runner`

### 2. SSH and run the bootstrap

```bash
scp scripts/e2e-runner/bootstrap.sh ubuntu@<runner-ip>:/tmp/bootstrap.sh
ssh ubuntu@<runner-ip>
# On the box:
RUNNER_TOKEN=$(gh api -X POST /orgs/WXYC/actions/runners/registration-token --jq .token)
sudo GHA_RUNNER_TOKEN="${RUNNER_TOKEN}" \
     GHA_RUNNER_URL=https://github.com/WXYC \
     bash /tmp/bootstrap.sh
```

The bootstrap is idempotent. Re-running it after a partial failure resumes from the failed step.

### 3. Verify

On the box:

```bash
systemctl status 'actions.runner.*.service'
```

On GitHub: <https://github.com/organizations/WXYC/settings/actions/runners> should show `wxyc-e2e-runner` as **Idle** with label `e2e-runner`.

### 4. Smoke run

From the local checkout, dispatch the wxyc-shared E2E suite against prod URLs targeting the runner:

```yaml
# Smoke workflow used only for phase 1 acceptance; not retained.
name: e2e-runner-smoke
on: workflow_dispatch
jobs:
  smoke:
    runs-on: [self-hosted, e2e-runner]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - env:
          E2E_BASE_URL: https://api.wxyc.org
          E2E_AUTH_URL: https://api.wxyc.org/auth
          E2E_TEST_DJ_EMAIL: ${{ secrets.E2E_TEST_DJ_EMAIL }}
          E2E_TEST_DJ_PASSWORD: ${{ secrets.E2E_TEST_DJ_PASSWORD }}
        run: npm run test:e2e
```

A green run completes phase 1. After that, this workflow is removed; the runner sits idle until phases 2/3/4 wire real gate workflows to it.

## Operations

### Replacing the instance

The bootstrap script is the source-of-truth. To rebuild:

1. Terminate the old instance.
2. Launch a fresh Ubuntu 24.04 instance with the same SG + tag.
3. Re-run the bootstrap with a fresh registration token.
4. Remove the dead runner from <https://github.com/organizations/WXYC/settings/actions/runners> (or it will auto-deregister after 14 days idle).

### Updating the runner agent

GitHub auto-updates the runner agent. To pin a version, set `RUNNER_VERSION` when invoking the bootstrap.

### Canary probe (separate ticket)

The runner liveness probe lives in [wxyc-canary](https://github.com/WXYC/wxyc-canary). It calls `GET /orgs/WXYC/actions/runners/<id>` every 5 min and alarms if `status != "online"` for ≥10 min. Implemented as part of phase 1 acceptance but tracked separately in the canary repo.

## Cost

t3.small on-demand in `us-east-1` is ~$0.0208/h ≈ $15/mo. A 1-year Standard Reserved Instance drops to ~$8/mo. EBS 20 GiB gp3 is ~$1.60/mo. Total ≤ $20/mo.

Per [cost-conscious-infra](https://github.com/WXYC/wiki/issues/80) constraints, do not scale this box up without confirming the workload requires it. If the E2E suites outgrow `t3.small`, prefer the reversible levers (instance class bump, scheduled stop/start outside business hours).

## Security notes

- The runner has no inbound exposure. The SG only needs egress 443.
- The runner runs jobs as user `runner` with Docker group membership. Workflows that mount the Docker socket can break out of the user boundary — keep that in mind if you ever schedule untrusted workflows here (current scope is WXYC repos only, no public forks).
- Registration token is short-lived (~1h). Never commit it.
- Use org-level runners (not repo-level) so token grants are visible org-wide.
