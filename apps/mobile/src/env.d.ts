// React Native/Expo runtimes provide `process.env` at runtime (Metro
// inlines EXPO_PUBLIC_* vars at build time) but don't ship a `process`
// ambient type the way Node does — declare just enough for our usage
// rather than pulling in the full @types/node (DOM-less RN environment).
declare const process: {
  env: Record<string, string | undefined>;
};
