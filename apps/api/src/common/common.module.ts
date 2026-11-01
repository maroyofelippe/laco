import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { StorageService } from './storage.service';
import { TokenService } from './token.service';
import { VisibilityService } from './visibility.service';

@Global()
@Module({
  providers: [AuditService, TokenService, VisibilityService, StorageService],
  exports: [AuditService, TokenService, VisibilityService, StorageService],
})
export class CommonModule {}
