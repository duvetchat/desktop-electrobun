{
  pkgs,
  lib,
  ...
}:

let
  # Electrobun's prebuilt CLI/bun/CEF, patched for Nix. Same derivation the flake package builds
  # with. Without it `electrobun` downloads FHS binaries that don't run outside FHS distros.
  electrobun = pkgs.callPackage ./nix/electrobun.nix { };

  # What the GTK layer of Electrobun's native wrapper looks up at runtime (file dialogs, icons).
  xdgDataDirs = lib.concatStringsSep ":" [
    "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}"
    "${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}"
    "${pkgs.adwaita-icon-theme}/share"
  ];
in
{
  # https://devenv.sh/languages/
  # bun runs the scripts and installs; node is needed by the svelte-kit/vite shebangs.
  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  # https://devenv.sh/packages/
  packages = [
    pkgs.git
    pkgs.xdg-utils # opening links from the app
    pkgs.xvfb-run # headless smoke runs: xvfb-run -a bun run dev
  ];

  # https://devenv.sh/tasks/
  tasks = {
    "duvet:install" = {
      exec = ''
        bun install
        (cd src/mainview && bun install)
      '';
      execIfModified = [
        "package.json"
        "bun.lock"
        "src/mainview/package.json"
        "src/mainview/bun.lock"
      ];
      before = [ "devenv:enterShell" ];
    };

    # `bun install` leaves node_modules/electrobun without its binaries; hand it the patched ones
    # so the CLI never goes to download its own. Must match the electrobun version in package.json.
    "duvet:electrobun-runtime" = {
      exec = ''
        d=node_modules/electrobun
        [ -d "$d" ] || exit 0
        want=$(${lib.getExe pkgs.jq} -r .dependencies.electrobun package.json)
        if [ "$want" != "${electrobun.version}" ]; then
          echo "package.json wants electrobun $want, nix/electrobun.nix has ${electrobun.version}: update it" >&2
          exit 1
        fi
        ln -sfn ${electrobun}/dist-linux-x64 "$d/dist-linux-x64"
        ln -sf ${electrobun}/bin/electrobun "$d/bin/electrobun"
      '';
      after = [ "duvet:install" ];
      before = [ "devenv:enterShell" ];
    };
  };

  # https://devenv.sh/basics/
  enterShell = ''
    export XDG_DATA_DIRS="${xdgDataDirs}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
    # GPU drivers on NixOS live here; harmless elsewhere.
    export LD_LIBRARY_PATH="''${LD_LIBRARY_PATH:+$LD_LIBRARY_PATH:}/run/opengl-driver/lib"
  '';

  # https://devenv.sh/tests/
  enterTest = ''
    bun --version
    node_modules/electrobun/dist-linux-x64/bun --version
    bun run --cwd src/mainview build
  '';

  # See full reference at https://devenv.sh/reference/options/
}
