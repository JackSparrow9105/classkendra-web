// Switch `useMock` to false once the .NET API is running.
// Every service then calls `${apiUrl}/...` instead of the in-memory mock.
export const environment = {
  production: false,
  useMock: false,
  apiUrl: 'https://localhost:7062/api/v1',
  // How login codes are sent: 'api' = the API sends them (WhatsApp), 'firebase' = SMS through Firebase.
  otpProvider: 'api' as 'api' | 'firebase',
  // From Firebase console → Project settings → Your apps → Web app. These are public values, safe in the app.
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
};
