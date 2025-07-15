import { Component } from '@angular/core';
import { PageHeaderComponent } from '../page-header/page-header.component';

@Component({
  selector: 'app-history-view',
  standalone: true,
  imports: [PageHeaderComponent],
  templateUrl: './history-view.component.html',
  styleUrl: './history-view.component.scss',
})
export class HistoryViewComponent {}
