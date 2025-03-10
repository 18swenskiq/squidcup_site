import { Component } from '@angular/core';
import { PageHeaderComponent } from '../page-header/page-header.component';

@Component({
  selector: 'app-games-view',
  standalone: true,
  imports: [PageHeaderComponent],
  templateUrl: './games-view.component.html',
  styleUrl: './games-view.component.scss',
})
export class GamesViewComponent {}
