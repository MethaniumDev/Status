{
  description = "Methanium Status";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs =
    {
      self,
      nixpkgs,
      rust-overlay,
      ...
    }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor =
        system:
        import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          root = toString ./.;
          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            targets = [ "wasm32-unknown-unknown" ];
          };
          wasmBindgenCli = pkgs.rustPlatform.buildRustPackage rec {
            pname = "wasm-bindgen-cli";
            version = "0.2.127";
            src = pkgs.fetchCrate {
              inherit pname version;
              hash = "sha256-di+qBAdd7pENLiIB9CoZoab+W5xeDoByMREcCGTSzWo=";
            };
            cargoHash = "sha256-FTv2GZIAQs0ePdIZXIXil7JbZ6kIT05VG6vqC1qNFxQ=";
            doCheck = false;
          };
          mtpSource = pkgs.fetchzip {
            url = "https://git.methanium.net/methanium/mtp/releases/download/0.4.0-dev-9f7f94e/mtp-0.4.0.tgz";
            hash = "sha256-GrzbRlfG4zBNEgvBqqHV7N6T3Nj6dYjDyxWEEBjqu9k=";
          };
          mtpCargoDeps = pkgs.rustPlatform.fetchCargoVendor {
            src = mtpSource;
            sourceRoot = "source/.rust";
            hash = "sha256-wrBgg1fXxsQoFCE1wnPdoPi9MxvyRjvpIj3eSxFlmqI=";
          };
          source = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter =
              path: _type:
              let
                relative = pkgs.lib.removePrefix "${root}/" (toString path);
              in
              !(pkgs.lib.hasPrefix ".git/" relative)
              && !(pkgs.lib.hasInfix "node_modules" relative)
              && !(pkgs.lib.hasInfix "target/" relative)
              && !(pkgs.lib.hasInfix "apps/frontend/dist/" relative)
              && relative != "result";
          };
          frontendNativeBuildInputs = [
            pkgs.binaryen
            pkgs.cacert
            pkgs.git
            pkgs.nodejs
            pkgs.pnpm
            pkgs.wasm-pack
            rustToolchain
            wasmBindgenCli
          ];
          frontendDeps = pkgs.fetchPnpmDeps {
            pname = "methanium-status-frontend-deps";
            version = "0.1.0";
            src = source;
            pnpm = pkgs.pnpm;
            fetcherVersion = 4;
            hash = "sha256-9F3jtDCXQo2h5bsPgXs7xyU+eFZ2aYEcUcEd6zZoWnw=";
          };
          frontend = pkgs.stdenvNoCC.mkDerivation {
            pname = "methanium-status-frontend";
            version = "0.1.0";
            src = source;
            nativeBuildInputs = frontendNativeBuildInputs ++ [ pkgs.pnpmConfigHook ];
            pnpmDeps = frontendDeps;

            buildPhase = ''
              runHook preBuild
              export HOME="$TMPDIR/home"
              export CARGO_HOME="$TMPDIR/cargo"
              export CARGO_NET_OFFLINE=true
              mkdir -p "$CARGO_HOME"
              cat > "$CARGO_HOME/config.toml" <<EOF
              [source.crates-io]
              replace-with = "vendored-sources"

              [source.vendored-sources]
              directory = "${mtpCargoDeps}/source-registry-0"
              EOF
              pnpm build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              cp -r apps/frontend/dist "$out"
              runHook postInstall
            '';
          };
          backend = pkgs.rustPlatform.buildRustPackage {
            pname = "methanium-status";
            version = "0.1.0";
            src = source;
            cargoRoot = "apps/backend";
            buildAndTestSubdir = "apps/backend";
            MTP_TYPE_MAPS = "${source}/apps/frontend/type-maps.yaml";
            cargoLock = {
              lockFile = ./apps/backend/Cargo.lock;
              outputHashes = {
                "mtp-0.4.0" = "sha256-XPTSHkbcUE4PguJXBlXzL74JADG4Kjp5eB11llMcxxc=";
              };
            };
            nativeBuildInputs = [ pkgs.cmake ];
          };
        in
        {
          default = frontend;
          inherit backend frontend;
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [
              "clippy"
              "rust-src"
              "rustfmt"
            ];
            targets = [ "wasm32-unknown-unknown" ];
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.cmake
              pkgs.curl
              pkgs.nodejs
              pkgs.openssl
              pkgs.pnpm
              pkgs.wasm-pack
              rustToolchain
            ];
          };
        }
      );

      checks = forAllSystems (system: {
        inherit (self.packages.${system}) backend frontend;
      });

      nixosModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.methanium-status;
          acmeHost = if cfg.acmeHost == null then cfg.hostName else cfg.acmeHost;
          serviceType = lib.types.submodule {
            options = {
              id = lib.mkOption {
                type = lib.types.str;
                description = "Stable service identifier.";
              };
              name = lib.mkOption {
                type = lib.types.str;
                description = "Service display name.";
              };
              url = lib.mkOption {
                type = lib.types.str;
                description = "HTTP or HTTPS URL to check.";
              };
              checkHttp3 = lib.mkOption {
                type = lib.types.bool;
                default = false;
                description = "Whether this service must also pass an HTTP/3-only check.";
              };
            };
          };
          categoryType = lib.types.submodule {
            options = {
              id = lib.mkOption {
                type = lib.types.str;
                description = "Stable category identifier.";
              };
              name = lib.mkOption {
                type = lib.types.str;
                description = "Category display name.";
              };
              logo = lib.mkOption {
                type = lib.types.path;
                description = "Local SVG, PNG, WebP, or JPEG logo file.";
              };
              services = lib.mkOption {
                type = lib.types.listOf serviceType;
                default = [ ];
                description = "Services shown and monitored in this category.";
              };
            };
          };
          configFile = (pkgs.formats.json { }).generate "methanium-status.json" {
            public_address = cfg.publicAddress;
            public_port = cfg.publicPort;
            admin_address = cfg.adminAddress;
            admin_port = cfg.adminPort;
            check_interval_seconds = cfg.checkInterval;
            timeout_seconds = cfg.timeout;
            certificate = "/var/lib/acme/${acmeHost}/fullchain.pem";
            private_key = "/var/lib/acme/${acmeHost}/key.pem";
            frontend_dir = toString cfg.frontendPackage;
            state_dir = "/var/lib/${cfg.stateDirectory}";
            curl = "${pkgs.curl}/bin/curl";
            categories = map (category: {
              inherit (category) id name;
              logo = toString category.logo;
              services = map (service: {
                inherit (service) id name url;
                check_http3 = service.checkHttp3;
              }) category.services;
            }) cfg.categories;
          };
        in
        {
          options.services.methanium-status = {
            enable = lib.mkEnableOption "Methanium Status monitoring and status page";
            package = lib.mkPackageOption self.packages.${pkgs.stdenv.hostPlatform.system} "backend" { };
            frontendPackage =
              lib.mkPackageOption self.packages.${pkgs.stdenv.hostPlatform.system} "frontend"
                { };
            hostName = lib.mkOption {
              type = lib.types.str;
              default = "status.methanium.net";
              description = "Public status page hostname.";
            };
            acmeHost = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "ACME certificate name, defaulting to hostName.";
            };
            publicAddress = lib.mkOption {
              type = lib.types.str;
              default = "0.0.0.0";
              description = "Address on which the UDP MTP server listens.";
            };
            publicPort = lib.mkOption {
              type = lib.types.port;
              default = 443;
              description = "Public UDP port for the MTP server.";
            };
            adminAddress = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = "Address for the unauthenticated incident editor.";
            };
            adminPort = lib.mkOption {
              type = lib.types.port;
              default = 8081;
              description = "TCP port for the unauthenticated incident editor.";
            };
            checkInterval = lib.mkOption {
              type = lib.types.ints.positive;
              default = 300;
              description = "Seconds between service checks.";
            };
            timeout = lib.mkOption {
              type = lib.types.ints.positive;
              default = 15;
              description = "Per-check timeout in seconds.";
            };
            stateDirectory = lib.mkOption {
              type = lib.types.str;
              default = "methanium-status";
              description = "systemd state directory name for incident history.";
            };
            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Open the public UDP port in the firewall.";
            };
            openAdminFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Open the unauthenticated admin TCP port. Use with care.";
            };
            categories = lib.mkOption {
              type = lib.types.listOf categoryType;
              description = "Status categories and checked services.";
              default = [
                {
                  id = "methanium";
                  name = "Methanium";
                  logo = ./apps/frontend/public/methanium.svg;
                  services = [
                    {
                      id = "methanium-homepage";
                      name = "Homepage";
                      url = "https://methanium.net";
                    }
                    {
                      id = "methanium-ui";
                      name = "Methanium UI";
                      url = "https://ui.methanium.net";
                    }
                    {
                      id = "vector-verdict";
                      name = "Vector Verdict";
                      url = "https://vv.methanium.net";
                    }
                    {
                      id = "methanium-git";
                      name = "Git";
                      url = "https://git.methanium.net";
                    }
                    {
                      id = "methanium-legal";
                      name = "Legal Page";
                      url = "https://legal.methanium.net";
                    }
                  ];
                }
                {
                  id = "tensamin";
                  name = "Tensamin";
                  logo = ./apps/frontend/public/tensamin.svg;
                  services = [
                    {
                      id = "tensamin-homepage";
                      name = "Homepage";
                      url = "https://tensamin.net";
                    }
                    {
                      id = "tensamin-docs";
                      name = "Docs";
                      url = "https://docs.tensamin.net";
                    }
                  ]
                  ++
                    lib.concatMap
                      (
                        channel:
                        let
                          domain = "${channel}.tensamin.net";
                        in
                        [
                          {
                            id = "tensamin-${channel}-app";
                            name = "Web App";
                            url = if channel == "stable" then "https://app.tensamin.net" else "https://app.${domain}";
                          }
                          {
                            id = "tensamin-${channel}-omega";
                            name = "Omega";
                            url = "https://omega.${domain}/.well-known/tensamin";
                            checkHttp3 = true;
                          }
                          {
                            id = "tensamin-${channel}-omikron-1";
                            name = "Omikron 1";
                            url = "https://omikron.${domain}";
                            checkHttp3 = true;
                          }
                        ]
                      )
                      [
                        "dev"
                        "stable"
                        "canary"
                      ];
                }
              ];
            };
          };

          config = lib.mkIf cfg.enable {
            users.groups.methanium-status = { };
            users.users.methanium-status = {
              isSystemUser = true;
              group = "methanium-status";
            };

            security.acme.certs.${acmeHost} = {
              group = "methanium-status";
              reloadServices = [ "methanium-status.service" ];
            };

            systemd.services.methanium-status = {
              description = "Methanium Status monitor";
              wantedBy = [ "multi-user.target" ];
              wants = [
                "network-online.target"
                "acme-${acmeHost}.service"
              ];
              after = [
                "network-online.target"
                "acme-${acmeHost}.service"
              ];
              restartTriggers = [ configFile ];
              serviceConfig = {
                User = "methanium-status";
                Group = "methanium-status";
                StateDirectory = cfg.stateDirectory;
                ExecStart = "${cfg.package}/bin/methanium-status ${configFile}";
                Restart = "on-failure";
                RestartSec = 5;
                AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ];
                CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
                LockPersonality = true;
                NoNewPrivileges = true;
                PrivateDevices = true;
                PrivateTmp = true;
                ProtectClock = true;
                ProtectControlGroups = true;
                ProtectHome = true;
                ProtectHostname = true;
                ProtectKernelLogs = true;
                ProtectKernelModules = true;
                ProtectKernelTunables = true;
                ProtectSystem = "strict";
                RestrictAddressFamilies = [
                  "AF_INET"
                  "AF_INET6"
                ];
                RestrictNamespaces = true;
                RestrictRealtime = true;
                SystemCallArchitectures = "native";
                UMask = "0077";
              };
            };

            networking.firewall.allowedTCPPorts = lib.optionals cfg.openAdminFirewall [ cfg.adminPort ];
            networking.firewall.allowedUDPPorts = lib.optionals cfg.openFirewall [ cfg.publicPort ];
          };
        };
    };
}
