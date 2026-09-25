// The shared package ships this JavaScript subpath without a declaration file.
declare module 'elowen-plugin-shared/configNumber' {
  export function clampConfig(value: unknown, fallback: number, min: number, max: number): number;
}
