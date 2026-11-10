/** @type {import('next').NextConfig} */
const nextConfig = {
  // RDKit's wasm is loaded from a CDN at runtime, so nothing to bundle here.
  reactStrictMode: true,
};
export default nextConfig;
