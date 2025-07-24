# @squidcup/shared-lambda-utils

Shared utilities for SquidCup Lambda functions to eliminate inter-Lambda communication overhead and provide consistent types and utilities across all Lambda functions.

## Installation

This package can be installed in any Lambda function that needs shared utilities:

```bash
npm install file:../../packages/shared-lambda-utils
```

Or if published to npm:
```bash
npm install @squidcup/shared-lambda-utils
```

## Usage

```typescript
import { 
  createCorsHeaders, 
  createApiResponse, 
  extractSteamIdFromOpenId,
  getSession,
  Session,
  QueueData 
} from '@squidcup/shared-lambda-utils';

// Create standardized responses
const response = createApiResponse(200, { message: 'Success' });

// Extract Steam ID
const steamId = extractSteamIdFromOpenId(session.steamId);

// Use shared types
const queue: QueueData = {
  // ... queue data
};
```

## Structure

- `types/` - Shared TypeScript interfaces and types
- `utils/` - Common utility functions (CORS, responses, validation)
- `auth/` - Authentication and session utilities
- `database/` - Database operations (to be migrated from database-service-lambda)

## Benefits

- **Performance**: Eliminates Lambda-to-Lambda invocation overhead
- **Type Safety**: Shared TypeScript types across all functions
- **Consistency**: Standardized error handling and response formats
- **Maintainability**: Centralized utility functions

## Development

```bash
# Build the package
npm run build

# Watch for changes
npm run build:watch

# Clean build artifacts
npm run clean
```

## Migration Strategy

Database operations will be gradually migrated from the `database-service-lambda` to this shared package to eliminate the performance overhead of inter-Lambda calls.
