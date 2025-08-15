import { Routes } from '@angular/router';
import { HistoryViewComponent } from './history-view/history-view.component';
import { LeaderboardViewComponent } from './leaderboard-view/leaderboard-view.component';
import { MainViewComponent } from './main-view/main-view.component';
import { PlayViewComponent } from './play-view/play-view.component';
import { AdminViewComponent } from './admin-view/admin-view.component';
import { MapsViewComponent } from './maps-view/maps-view.component';
import { AdminGuard } from './guards/admin.guard';

export const routes: Routes = [
  { path: '', component: MainViewComponent },
  { path: 'leaderboard', component: LeaderboardViewComponent },
  { path: 'history', component: HistoryViewComponent },
  { path: 'maps', component: MapsViewComponent },
  { path: 'play', component: PlayViewComponent },
  { path: 'admin', component: AdminViewComponent, canActivate: [AdminGuard] }
];
