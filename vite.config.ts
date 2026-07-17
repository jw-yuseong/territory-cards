import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" — GitHub Pages가 https://계정.github.io/저장소이름/ 형태로
// 서빙하므로 상대 경로로 빌드해야 함
export default defineConfig({
  plugins: [react()],
  base: "./",
});
