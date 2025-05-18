# How to Develop

First install `bun` and `docker`.

Install dependencies:

```sh
bun install
```

Edit environment variables:

```sh
cp .env.example .env
```

Fill the blanks, and run:

```sh
docker compose up -d
bun run drizzle-kit push
bun run dev
```

App runs on the port you specified in the environment variables.
