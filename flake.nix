{
  description = "Duvet desktop client (Electrobun + SvelteKit)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      electrobun-runtime = pkgs.callPackage ./nix/electrobun.nix { };
      duvet-desktop = pkgs.callPackage ./nix/package.nix { inherit electrobun-runtime; };
    in
    {
      packages.${system} = {
        default = duvet-desktop;
        inherit duvet-desktop electrobun-runtime;
      };

      apps.${system}.default = {
        type = "app";
        program = "${duvet-desktop}/bin/duvet-desktop";
        meta.description = duvet-desktop.meta.description;
      };

      overlays.default = final: _prev: {
        duvet-desktop = final.callPackage ./nix/package.nix {
          electrobun-runtime = final.callPackage ./nix/electrobun.nix { };
        };
      };
    };
}
