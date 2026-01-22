# E2E Tests

End-to-end tests for WXYC services that verify full-stack integration.

## Prerequisites

Before running E2E tests, ensure:

1. Backend service is running (or use the Docker Compose setup)
2. Database is seeded with test data
3. Environment variables are configured

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npm run test:e2e -- e2e/flowsheet.test.ts
```

## Test Categories

### Flowsheet E2E (`flowsheet.test.ts`)
- Create, read, update, delete flowsheet entries
- Pagination and filtering
- Show lifecycle

### Catalog E2E (`catalog.test.ts`)
- Album and artist search
- Adding new albums/artists
- Rotation management

### Auth E2E (`auth.test.ts`)
- DJ authentication flow
- Anonymous device registration
- Token refresh

### SSE E2E (`sse.test.ts`)
- Real-time event streaming
- Topic subscription
- Event broadcasting

## Configuration

E2E tests use environment variables for configuration:

```env
E2E_BASE_URL=http://localhost:8080
E2E_AUTH_URL=http://localhost:8081/auth
E2E_TEST_DJ_EMAIL=test@wxyc.org
E2E_TEST_DJ_PASSWORD=testpassword
```
