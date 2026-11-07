// Used by `ng build` and `ng deploy` (the production build). `ng serve` uses environment.ts.
// After creating the API on Azure, put its address here (Azure portal → your App Service → Overview → Default domain).
export const environment = {
  production: true,
  useMock: false,
  apiUrl: 'https://classkendra-api-aad5hxgzf5dtc8fe.centralindia-01.azurewebsites.net/api/v1',
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
