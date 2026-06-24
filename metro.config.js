const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.cacheVersion = 'v8';

config.resolver = config.resolver || {};
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['browser', 'require', 'default'];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  xlsx: require.resolve('xlsx/dist/xlsx.full.min.js'),
  'expo-image-picker': path.resolve(__dirname, 'src/lib/imagePicker.web.ts'),
};

config.transformer = config.transformer || {};
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: false,
  },
});

module.exports = config;
