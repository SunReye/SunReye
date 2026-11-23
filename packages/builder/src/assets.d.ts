// What a consumer's bundler hands the package for an asset it ships: Vite's `?url` import.

declare module "*.glb?url" {
  const url: string;
  export default url;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
