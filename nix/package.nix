# The Duvet desktop app: SvelteKit UI built by vite, wrapped by `electrobun build` into a plain
# app directory (launcher + bun + CEF), run through a wrapper that supplies the runtime env.
{
  lib,
  stdenv,
  bun,
  nodejs,
  cacert,
  makeWrapper,
  wrapGAppsHook3,
  gtk3,
  glib,
  gsettings-desktop-schemas,
  adwaita-icon-theme,
  xdg-utils,
  playerctl,
  electrobun-runtime,
}:

let
  pkg = lib.importJSON ../package.json;

  # Only manifests, so editing source never re-downloads node_modules.
  depsSrc = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../patches
      ../src/mainview/package.json
      ../src/mainview/bun.lock
      ../src/mainview/.npmrc
      ../src/mainview/patches
    ];
  };

  # Fixed-output: network is allowed here, and only here. Update `outputHash` after changing
  # either bun.lock or a patch in patches or src/mainview/patches (set it to lib.fakeHash, build,
  # copy the hash from the error).
  nodeModules = stdenv.mkDerivation {
    pname = "duvet-desktop-node-modules";
    inherit (pkg) version;
    src = depsSrc;
    nativeBuildInputs = [ bun ];

    dontConfigure = true;
    # Fixup would patch shebangs to store paths, which a fixed-output derivation may not reference.
    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
      # Root: electrobun, and i18next, i18next-icu and intl-messageformat for the Bun bundle
      # (src/bun/i18n.ts); the lint/format tooling is dev-only.
      bun install --frozen-lockfile --production --ignore-scripts --no-progress
      (cd src/mainview && bun install --frozen-lockfile --ignore-scripts --no-progress)
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out/src/mainview
      cp -a node_modules $out/
      cp -a src/mainview/node_modules $out/src/mainview/
      runHook postInstall
    '';

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-Kme3vOLtk+vMQ0Cn0AxJ95SAtpjvSXlp+AeuM6cPDDY=";
  };

  src = lib.cleanSourceWith {
    src = ../.;
    filter =
      path: _type:
      !builtins.elem (baseNameOf path) [
        ".git"
        ".github"
        ".devenv"
        ".direnv"
        ".claude"
        ".vscode"
        "graphify-out"
        "node_modules"
        "build"
        "artifacts"
        ".svelte-kit"
        "nix"
        "flake.nix"
        "flake.lock"
        "devenv.nix"
        "devenv.yaml"
        "devenv.lock"
        "result"
      ];
  };
in
assert lib.assertMsg (pkg.dependencies.electrobun == electrobun-runtime.version)
  "package.json pins electrobun ${pkg.dependencies.electrobun} but nix/electrobun.nix fetches ${electrobun-runtime.version}";

stdenv.mkDerivation {
  pname = "duvet-desktop";
  inherit (pkg) version;
  inherit src;

  nativeBuildInputs = [
    bun
    nodejs # svelte-kit and vite start with a node shebang
    makeWrapper
    wrapGAppsHook3 # XDG_DATA_DIRS for GTK dialogs (gsettings schemas, icons), GIO modules
  ];

  buildInputs = [
    gtk3
    glib
    gsettings-desktop-schemas
    adwaita-icon-theme
  ];

  configurePhase = ''
    runHook preConfigure
    cp -r ${nodeModules}/. .
    chmod -R u+w node_modules src/mainview/node_modules
    patchShebangs node_modules src/mainview/node_modules
    # electrobun would download these at first run; point it at the patched copies instead.
    cp ${electrobun-runtime}/bin/electrobun node_modules/electrobun/bin/electrobun
    ln -s ${electrobun-runtime}/dist-linux-x64 node_modules/electrobun/dist-linux-x64
    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    (cd src/mainview && bun run build)
    # env=dev yields a plain app directory; the other envs build a self-extracting installer
    # that unpacks into $HOME at first run.
    bun run electrobun build --env=dev
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    app=$out/lib/duvet-desktop
    mkdir -p $app $out/bin $out/share/applications $out/share/icons/hicolor/256x256/apps
    cp -a build/dev-linux-x64/Duvet-dev/. $app/
    # The launcher preloads libcef.so by a path relative to its cwd.
    makeWrapper $app/bin/launcher $out/bin/duvet-desktop \
      --chdir $app/bin \
      --prefix PATH : ${lib.makeBinPath [ xdg-utils playerctl ]} \
      --suffix LD_LIBRARY_PATH : /run/opengl-driver/lib
    cp icon.iconset/icon_256x256.png $out/share/icons/hicolor/256x256/apps/duvet-desktop.png
    cat > $out/share/applications/duvet-desktop.desktop <<EOF
    [Desktop Entry]
    Type=Application
    Name=Duvet
    Exec=duvet-desktop
    Icon=duvet-desktop
    Terminal=false
    StartupWMClass=desktop
    Categories=Network;Chat;InstantMessaging;
    EOF
    # The Comment in English and in each language the app ships, as the build's postBuild hook wrote them into the
    # bundle's own entry (scripts/localize-bundle.ts, from electrobun.config.ts's app.description).
    grep '^Comment' build/dev-linux-x64/Duvet-dev/Duvet.desktop >> $out/share/applications/duvet-desktop.desktop
    runHook postInstall
  '';

  # The bundled bun is corrupted by strip and by patchelf --shrink-rpath; electrobun-runtime
  # already patched every binary that needs it.
  dontStrip = true;
  dontPatchELF = true;

  passthru = { inherit nodeModules; };

  meta = {
    description = "Duvet desktop client";
    mainProgram = "duvet-desktop";
    platforms = [ "x86_64-linux" ];
  };
}
