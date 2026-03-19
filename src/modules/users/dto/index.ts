export type UserRole = 'admin' | 'cashier' | 'manager' | 'employee' | 'customer';

export class CreateUserDto {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  role: UserRole;
  isActive?: boolean;
}

export class UpdateUserDto {
  email?: string;
  password?: string;
  name?: string;
  phone?: string;
  role?: UserRole;
  isActive?: boolean;
}
