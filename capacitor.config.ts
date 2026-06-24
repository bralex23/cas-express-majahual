import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.casexpress.majahual',
  appName: 'CAS Majahual',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    allowNavigation: [],
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {},
};

export default config;
