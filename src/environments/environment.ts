// Switch `useMock` to false once the .NET API is running.
// Every service then calls `${apiUrl}/...` instead of the in-memory mock.
export const environment = {
  production: false,
  useMock: false,
  apiUrl: 'https://localhost:7062/api/v1',
};
