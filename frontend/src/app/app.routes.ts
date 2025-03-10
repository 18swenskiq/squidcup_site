import { Routes } from '@angular/router';
import { ProjectsComponent } from './projects-view/projects.component';
import { GamesViewComponent } from './games-view/games-view.component';
import { MainViewComponent } from './main-view/main-view.component';
import { PlayViewComponent } from './play-view/play-view.component';

export const routes: Routes = [
  { path: '', component: MainViewComponent },
  { path: 'games', component: GamesViewComponent },
  { path: 'projects', component: ProjectsComponent },
  { path: 'play', component: PlayViewComponent }
];
