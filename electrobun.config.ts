// @ts-nocheck
import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json";

export default {
	app: {
		// The shortcut, the bundle (`Duvet-<channel>`) and the installer are named after it. The install folder, the
		// app's data and the uninstall key go by the identifier, so renaming the app moves none of them.
		name: "Duvet",
		version: pkg.version,
		identifier: "com.duvet.desktop",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		mac: {
			icon: "icon.iconset",
			// macOS asks before the app uses the microphone or the camera, with these lines: Electrobun writes an
			// entitlement's text into Info.plist as its usage description (audio-input as NSMicrophoneUsageDescription,
			// camera as NSCameraUsageDescription), and an app without them can't open either. Screen sharing needs no
			// entry: macOS asks for Screen Recording itself. With codesign on, Electrobun would also sign these texts as
			// the entitlements' values, where the hardened runtime wants true: check the mic and the camera then.
			entitlements: {
				"com.apple.security.device.audio-input":
					"Duvet uses your microphone for voice rooms, calls and voice messages.",
				"com.apple.security.device.camera": "Duvet uses your camera when you turn on video in a voice room or a call.",
			},
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
			"src/mainview/build/rnnoise-worklet-processor.js": "views/mainview/rnnoise-worklet-processor.js",

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
