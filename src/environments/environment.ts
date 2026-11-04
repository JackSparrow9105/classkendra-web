// Switch `useMock` to false once the .NET API is running.
// Every service then calls `${apiUrl}/...` instead of the in-memory mock.
export const environment = {
  production: false,
  useMock: true,
  apiUrl: 'https://localhost:7001/api/v1',
};
