import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// index.html 里的图标 <link> 会被 Vite 改写成独立资源文件，singlefile 不会处理它们，
// 单页构建就会多出几个 favicon 文件；这里把它们直接内联成 data URI，保住「单个 HTML 可离线打开」。
const ICON_MIME = { svg: "image/svg+xml", png: "image/png", ico: "image/x-icon" };

function inlineIcons() {
  return {
    name: "inline-icons",
    enforce: "post",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle ?? {};
        return html.replace(/<link[^>]+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g, (tag) => {
          const hrefMatch = tag.match(/href="([^"]+)"/);
          if (!hrefMatch) return tag;
          const rawHref = hrefMatch[1];
          const assetMatch = rawHref.match(/__VITE_ASSET__([a-zA-Z0-9_-]+)__/);
          const file = assetMatch
            ? this.getFileName(assetMatch[1])
            : Object.keys(bundle).find((f) => f.split("/").pop() === rawHref.split("/").pop());
          if (!file || !bundle[file]) return tag;
          const asset = bundle[file];
          const buf = Buffer.isBuffer(asset.source) ? asset.source : Buffer.from(asset.source, "utf8");
          const type = ICON_MIME[file.split(".").pop()] ?? "application/octet-stream";
          delete bundle[file];
          return tag.replace(rawHref, `data:${type};base64,${buf.toString("base64")}`);
        });
      },
    },
  };
}

// 默认：常规静态站点（dist/），依赖与资源按需拆分
// --mode single：把 JS / CSS 全部内联，产出可离线双击打开的单页（dist-single/index.html）
export default defineConfig(({ mode }) => {
  const single = mode === "single";
  return {
    base: "./",
    plugins: single ? [viteSingleFile(), inlineIcons()] : [],
    build: {
      outDir: single ? "dist-single" : "dist",
      target: "es2020",
      sourcemap: false,
    },
  };
});
