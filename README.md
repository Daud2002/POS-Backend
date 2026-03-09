# POS System Backend

A NestJS backend for the POS (Point of Sale) System using PostgreSQL and TypeORM.

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v12 or higher)
- npm or bun

## Installation

```bash
npm install
# or
bun install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update the `.env` file with your database credentials and configuration.

## Database Setup

The database will be automatically synchronized when the application starts (TypeORM synchronization enabled).

### Start PostgreSQL

Make sure PostgreSQL is running:

```bash
# Windows
# Start PostgreSQL service or use pgAdmin

# Linux/Mac
brew services start postgresql
# or
sudo service postgresql start
```

### Create Database

```bash
psql -U postgres
CREATE DATABASE pos_system;
\q
```

## Running the Application

### Development

```bash
npm run dev
```

The application will start on `http://localhost:3000`.

### API Documentation

Swagger API documentation is available at `http://localhost:3000/docs`

### Production Build

```bash
npm run build
npm run prod
```

### Debug Mode

```bash
npm run debug
```

## Project Structure

```
src/
├── config/           # Configuration files
├── database/         # TypeORM configuration
├── entities/         # Database entities
├── modules/          # Feature modules
│   ├── auth/
│   ├── users/
│   ├── products/
│   ├── categories/
│   ├── customers/
│   ├── orders/
│   ├── employees/
│   └── ...
├── common/           # Common utilities, guards, filters
├── app.module.ts     # Root module
└── main.ts           # Application entry point
```

## API Documentation

API endpoints will be available at `http://localhost:3000/api`.

Comprehensive Swagger documentation is available at `http://localhost:3000/docs`.

### Authentication

The API uses JWT tokens for authentication. Include the token in the `Authorization` header:

```
Authorization: Bearer <your_jwt_token>
```

## Testing

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov

# E2E tests
npm run test:e2e
```

## Linting and Formatting

```bash
# Lint
npm run lint

# Format code
npm run format
```

## Environment Variables

See `.env.example` for all available configuration options.

## License

MIT
