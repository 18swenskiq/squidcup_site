// Test setup file for database tests
// This file is run before each test file

// Mock the mysql2 module
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));

// Mock the AWS SDK modules
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(),
  GetParameterCommand: jest.fn(),
}));

// Global test utilities - export to make this a module
export {};

declare global {
  var mockDatabaseConnection: {
    execute: jest.Mock;
    end: jest.Mock;
  };
}

(global as any).mockDatabaseConnection = {
  execute: jest.fn(),
  end: jest.fn(),
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
