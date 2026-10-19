import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { User } from './user.entity';
import { UsersGuard } from './users.guard';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(UsersGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list(): Promise<User[]> {
    return this.service.findAll();
  }

  @Get(':email')
  byEmail(@Param('email') email: string): Promise<User | null> {
    return this.service.findByEmail(email);
  }
}
