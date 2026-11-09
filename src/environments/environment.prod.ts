// Used by `ng build` and `ng deploy` (the production build). `ng serve` uses environment.ts.
export const environment = {
  production: true,
  useMock: false,
  apiUrl: 'https://classkendra-api-aad5hxgzf5dtc8fe.centralindia-01.azurewebsites.net/api/v1',
  // How login codes are sent: 'api' = the API sends them (WhatsApp), 'firebase' = SMS through Firebase.
  otpProvider: 'firebase' as 'api' | 'firebase',
  // From Firebase console → Project settings → Your apps → Web app. These are public values, safe in the app.
  firebase: {
    apiKey: 'AIzaSyDjlPtz3iLm2zVTbi4bjnkzaGtiEv9o1N4',
    authDomain: 'class-kendra.firebaseapp.com',
    projectId: 'class-kendra',
    appId: '1:499014415591:web:0a198dc91e23287abe1e42',
  },
};