import { Component } from '@angular/core';
import { PageHeaderComponent } from '../page-header/page-header.component';

@Component({
  selector: 'app-leaderboard-view',
  standalone: true,
  imports: [PageHeaderComponent],
  templateUrl: './leaderboard-view.component.html',
  styleUrl: './leaderboard-view.component.scss',
})
export class LeaderboardViewComponent {}
