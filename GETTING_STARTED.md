# Getting Started with POS Backend

## Quick Start Guide

### 1. Prerequisites

- **Node.js** v18+ ([Download](https://nodejs.org/))
- **PostgreSQL** v12+ (or use Docker Compose)
- **npm** or **yarn**

### 2. Setup PostgreSQL

#### Option A: Using Docker Compose (Recommended)

```bash
docker-compose up -d
```

This will start PostgreSQL on `localhost:5432` with:
- Username: `postgres`
- Password: `postgres`
- Database: `pos_system`

#### Option B: Manual PostgreSQL Installation

1. Start PostgreSQL service on your system
2. Create database:
   ```bash
   psql -U postgres
   CREATE DATABASE pos_system;
   \q
   ```

### 3. Environment Setup

The `.env` file is already configured with default values:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=pos_system
PORT=3000
NODE_ENV=development
JWT_SECRET=your_jwt_secret_key_change_this_in_production
JWT_EXPIRATION=86400
CORS_ORIGIN=http://localhost:5173
```

**For production**, change the `JWT_SECRET` to a strong random value.

### 4. Start the Application

Development mode with auto-reload:

```bash
npm run dev
```

Or production build:

```bash
npm run build
npm run prod
```

The server will start on `http://localhost:3000`

### 5. Test the API

#### Register a new user

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123",
    "name": "Admin User"
  }'
```

#### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "password123"
  }'
```

You'll get a response with an `accessToken`. Copy this token for authenticated requests.

#### Get Profile (Requires Authentication)

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <your_token>"
```

### 6. Available API Endpoints

#### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user profile (Protected)

#### Categories
- `GET /api/categories` - Get all categories
- `GET /api/categories/:id` - Get category by ID
- `POST /api/categories` - Create category (Protected)
- `PATCH /api/categories/:id` - Update category (Protected)
- `DELETE /api/categories/:id` - Delete category (Protected)

#### Products
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get product by ID
- `GET /api/products/category/:categoryId` - Get products by category
- `POST /api/products` - Create product (Protected)
- `PATCH /api/products/:id` - Update product (Protected)
- `DELETE /api/products/:id` - Delete product (Protected)

#### Customers
- `GET /api/customers` - Get all customers
- `GET /api/customers/:id` - Get customer by ID
- `POST /api/customers` - Create customer (Protected)
- `PATCH /api/customers/:id` - Update customer (Protected)
- `DELETE /api/customers/:id` - Delete customer (Protected)

#### Orders
- `GET /api/orders` - Get all orders
- `GET /api/orders/:id` - Get order by ID
- `GET /api/orders/customer/:customerId` - Get orders by customer
- `POST /api/orders` - Create order (Protected)
- `PATCH /api/orders/:id` - Update order (Protected)
- `DELETE /api/orders/:id` - Delete order (Protected)

### 7. Database Schema

The database will be automatically synchronized on startup. The following tables will be created:

- **users** - Store user accounts
- **categories** - Product categories
- **products** - Product inventory
- **customers** - Customer information
- **orders** - Orders
- **order_items** - Order line items

### 8. Debugging

Run in debug mode:

```bash
npm run debug
```

Open VS Code debugger and attach to the Node process.

### 9. Troubleshooting

#### Port 3000 already in use

Change the port in `.env`:

```env
PORT=3001
```

#### Database connection refused

Make sure PostgreSQL is running:

```bash
# With Docker Compose
docker-compose ps

# Or check your PostgreSQL service status
```

#### JWT token errors

Ensure `JWT_SECRET` is set in `.env`. For development, the default is fine, but change it for production.

### 10. Next Steps

1. Connect your Frontend to this backend
2. Update `CORS_ORIGIN` in `.env` if your frontend runs on a different port
3. Test all endpoints with authentication
4. Deploy to production when ready

---

For more information, see [README.md](./README.md)
