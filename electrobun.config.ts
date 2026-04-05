// @ts-nocheck
import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json";

export default {
	app: {
		name: "desktop",
		version: pkg.version,
		identifier: "com.duvet.desktop",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		mac: {
			icon: "icon.iconset",
		},
		win: {
			icon: "icon.iconset/icon.ico",
		},
		linux: {
			icon: "icon.iconset/icon_256x256.png",
			bundleCEF: true,
		},
		copy: {
			"src/mainview/build/_app": "views/mainview/_app",
			"src/mainview/build/sounds": "views/mainview/sounds",
			"src/mainview/build/badges": "views/mainview/badges",

			"src/mainview/build/app.html": "views/mainview/app.html",
			"src/mainview/build/index.html": "views/mainview/index.html",

			"src/mainview/build/sign-in.html": "views/mainview/sign-in.html",
			"src/mainview/build/sign-up.html": "views/mainview/sign-up.html",
			"src/mainview/build/forgot-password.html": "views/mainview/forgot-password.html",
			"src/mainview/build/verify.html": "views/mainview/verify.html",
			"src/mainview/build/reset-password.html": "views/mainview/reset-password.html",
			"src/mainview/build/change-email.html": "views/mainview/change-email.html",
			"src/mainview/build/invite.html": "views/mainview/invite.html",
		},
		watchIgnore: ["dist/**"],
	},
	runtime: {
		dragRegions: true,
	},
} satisfies ElectrobunConfig;
