# Methanium Status

Live availability and incident reporting for Methanium and Tensamin services. The Rust backend checks configured URLs every five minutes, verifies HTTP/3 where requested, persists incident history, and pushes snapshots to the React status page over MTP/WebTransport.

## Development

```sh
nix develop
pnpm install
pnpm check
pnpm dev
```

`pnpm dev` generates a short-lived localhost certificate, uses it for the HTTPS frontend and WebTransport backend, and writes the matching WebTransport certificate hash. The public page is available on Vite's displayed HTTPS URL and the incident editor is available at `http://127.0.0.1:8091/edit` after the frontend has been built once.

For a manual backend configuration, copy `config.example.toml`, update the certificate paths, build the frontend, and run:

```sh
pnpm build
cargo run --manifest-path apps/backend/Cargo.toml -- ./config.toml
```

Set `VITE_MTP_URL` when the development MTP endpoint is not available at the frontend's own `/mtp` origin.

## Configuration

The backend accepts TOML or JSON. Categories contain a local logo and a list of services. Service names and URLs are not editable through the incident UI.

```toml
[[categories]]
id = "example"
name = "Example"
logo = "/path/to/example.svg"

[[categories.services]]
id = "example-home"
name = "Homepage"
url = "https://example.com"
check_http3 = true
```

HTTP 200 through 399 is operational. DNS, connection, and TLS failures are reported as offline; timeouts, HTTP error responses, and HTTP/3 failures have distinct labels. Every non-operational service state uses red on the public page.

The admin page is available at `/edit` on the separately configured admin address and port. It has intentionally no authentication, so the backend requires the admin address to be loopback. The NixOS module binds it to `127.0.0.1:8081` and does not open its firewall port by default. For remote use, prefer an SSH tunnel:

```sh
ssh -L 8081:127.0.0.1:8081 status-host
```

## NixOS

The included module serves the SPA with nginx on TCP 443 and MTP HTTP/3/WebTransport on UDP 443. Both use the same ACME certificate and origin.

```nix
{
  inputs.methanium-status.url =
    "git+https://git.methanium.net/methanium/status";

  outputs = { nixpkgs, methanium-status, ... }: {
    nixosConfigurations.host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        methanium-status.nixosModules.default
        {
          security.acme.acceptTerms = true;
          security.acme.defaults.email = "admin@example.com";

          services.methanium-status = {
            enable = true;
            hostName = "status.example.com";
            openFirewall = true;

            categories = [{
              id = "example";
              name = "Example";
              logo = ./example.svg;
              services = [{
                id = "example-home";
                name = "Homepage";
                url = "https://example.com";
                checkHttp3 = false;
              }];
            }];
          };
        }
      ];
    };
  };
}
```

Use `acmeHost` to share an already configured NixOS ACME certificate. The service options also expose the check interval, timeout, public listener, admin listener, state directory, packages, firewall behavior, categories, logo paths, and services.

Contact: [contact@methanium.net](mailto:contact@methanium.net)

Security: [security@methanium.net](mailto:security@methanium.net)
