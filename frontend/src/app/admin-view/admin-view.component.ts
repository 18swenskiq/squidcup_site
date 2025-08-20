import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../page-header/page-header.component';
import { ServerManagementComponent } from './server-management/server-management.component';
import { QueueManagementComponent } from './queue-management/queue-management.component';
import { EloManagementComponent } from './elo-management/elo-management.component';

@Component({
  selector: 'app-admin-view',
  standalone: true,
  imports: [PageHeaderComponent, CommonModule, ServerManagementComponent, QueueManagementComponent, EloManagementComponent],
  templateUrl: './admin-view.component.html',
  styleUrl: './admin-view.component.scss',
})
export class AdminViewComponent {
  activeTab: 'servers' | 'queues' | 'elo' = 'servers';

  switchTab(tab: 'servers' | 'queues' | 'elo'): void {
    this.activeTab = tab;
  }
}
