# Electrobun's prebuilt Linux runtime (CLI, bun, native wrapper, CEF), patched for Nix.
#
# `electrobun` downloads these from GitHub at first run, into node_modules/electrobun. They are
# glibc binaries that look for /lib64/ld-linux and libs in FHS paths, so on Nix we fetch them with
# fixed hashes and autoPatchelf them instead. Shared by flake.nix (package) and devenv.nix (shell).
#
# Bump `version` together with the "electrobun" version in package.json (package.nix asserts it),
# then refresh `hashes` from the release asset digests:
#   nix hash convert --hash-algo sha256 --to sri <sha256 digest from the GitHub release page>
{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  # direct NEEDED libs
  glib,
  gtk3,
  cairo,
  pango,
  gdk-pixbuf,
  webkitgtk_4_1,
  libsoup_3,
  libayatana-appindicator,
  nss,
  nspr,
  at-spi2-core,
  cups,
  dbus,
  expat,
  libxkbcommon,
  libgbm,
  alsa-lib,
  systemd,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxrandr,
  # dlopen'd by Chromium at runtime: audio, screen capture, video acceleration, GPU
  libpulseaudio,
  pipewire,
  libva,
  vulkan-loader,
  libglvnd,
  wayland,
  libdrm,
}:

let
  version = "1.15.1";

  hashes = {
    cli = "sha256-N5U/fJfX6Jbph5T8YjdzYApZ0wzjERTf1FqtPdCmdpk=";
    core = "sha256-gp30HQKPgO/XQSQF/KLfuNLhgPOrheZ7BpxdWUFK3Fw=";
    cef = "sha256-7o5UqZMNQQ3j8Jf7xFhmZSv0BL9dmmmDStwHpinP4cc=";
  };

  asset =
    kind:
    fetchurl {
      url = "https://github.com/blackboardsh/electrobun/releases/download/v${version}/electrobun-${kind}-linux-x64.tar.gz";
      hash = hashes.${kind};
    };

  # Chromium dlopen()s these, so they are not in any NEEDED list.
  dlopenLibs = [
    libpulseaudio
    pipewire
    libva
    vulkan-loader
    libglvnd
    wayland
    libdrm
    libgbm
    systemd
  ];
in
stdenv.mkDerivation {
  pname = "electrobun-runtime";
  inherit version;

  srcs = [
    (asset "cli")
    (asset "core")
    (asset "cef")
  ];
  sourceRoot = ".";

  nativeBuildInputs = [ autoPatchelfHook ];
  buildInputs = [
    glib
    gtk3
    cairo
    pango
    gdk-pixbuf
    webkitgtk_4_1
    libsoup_3
    libayatana-appindicator
    nss
    nspr
    at-spi2-core
    cups
    dbus
    expat
    libxkbcommon
    libgbm
    alsa-lib
    systemd
    libx11
    libxcb
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    stdenv.cc.cc.lib
  ]
  ++ dlopenLibs;
  runtimeDependencies = dlopenLibs;

  # Run by hand in postFixup: `patchelf --set-rpath` corrupts the bun-based binaries (bun, and
  # the CLI, a bun single-file executable with its payload appended), so those only get a new
  # interpreter. They need nothing but glibc. Stripping would also drop the CLI payload.
  dontAutoPatchelf = true;
  dontStrip = true;

  # The three tarballs have no common top directory, so unpack them side by side.
  unpackPhase = ''
    runHook preUnpack
    srcs=($srcs)
    mkdir cli core
    tar -xzf "''${srcs[0]}" -C cli
    tar -xzf "''${srcs[1]}" -C core
    tar -xzf "''${srcs[2]}" -C core   # holds cef/
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    install -m755 cli/electrobun $out/bin/electrobun
    cp -r core $out/dist-linux-x64
    runHook postInstall
  '';

  postFixup = ''
    dist=$out/dist-linux-x64
    patchelf --set-interpreter "$(cat $NIX_BINTOOLS/nix-support/dynamic-linker)" \
      $out/bin/electrobun $dist/bun $dist/extractor
    autoPatchelf $dist/cef $dist/*.so $dist/process_helper
    # autoPatchelf only applies runtimeDependencies to executables, but libcef.so is what
    # dlopen()s pulse/pipewire/vaapi/GL, and dlopen searches the caller's own RUNPATH.
    for lib in $dist/cef/*.so*; do
      patchelf --add-rpath ${lib.makeLibraryPath dlopenLibs} "$lib"
    done
  '';

  passthru = { inherit dlopenLibs; };

  meta = {
    description = "Prebuilt Electrobun runtime (CLI, bun, native wrapper, CEF) patched for Nix";
    homepage = "https://electrobun.dev";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
