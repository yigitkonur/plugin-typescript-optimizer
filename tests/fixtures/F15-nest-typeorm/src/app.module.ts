import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './users/user.entity';
import { Post } from './users/post.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqljs',
      entities: [User, Post],
      synchronize: true,
    }),
    UsersModule,
  ],
})
export class AppModule {}
