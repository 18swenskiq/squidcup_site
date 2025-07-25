# @squidcup/types

Shared TypeScript type definitions for the SquidCup platform. This package contains all common types used across the frontend, Lambda functions, and other services.

## Installation

```bash
# For Lambda functions (via file path)
npm install file:../../packages/types-squidcup

# For frontend (via file path)
npm install file:../packages/types-squidcup
```

## Usage

```typescript
import { 
  QueueData, 
  LobbyData, 
  User, 
  Session,
  GameMode,
  ApiResponse 
} from '@squidcup/types';

// Use the types in your code
const queue: QueueData = {
  id: '123',
  game_mode: '5v5',
  // ... other properties
};

const response: ApiResponse<QueueData> = {
  success: true,
  data: queue
};
```

## Type Categories

### Core Game Types
- `GameMode` - '5v5' | 'wingman' | '3v3' | '1v1'
- `MapSelectionMode` - 'random' | 'vote' | 'host_pick'
- `QueueStatus` - 'waiting' | 'matched' | 'cancelled'
- `LobbyStatus` - 'active' | 'in_game' | 'completed' | 'cancelled'

### Data Models
- `User` - User profile information
- `Session` - Authentication session data
- `QueueData` - Queue information and players
- `LobbyData` - Lobby information and players
- `Server` - Game server information

### API Types
- `ApiResponse<T>` - Standardized API response format
- `PaginatedResponse<T>` - Paginated API responses
- `LambdaResponse` - AWS Lambda response format

### Frontend Types
- `ViewState` - UI state management
- `QueueFormData` - Queue creation form data

### Enhanced Types
- `EnrichedQueueData` - Queue data with player names
- `EnrichedLobbyData` - Lobby data with player names

## Benefits

- **Consistency**: Same types across all services
- **Type Safety**: Full TypeScript support
- **Maintainability**: Single source of truth for data structures
- **Frontend Integration**: Shared types between backend and frontend
