import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-workshop-item-card',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './workshop-item-card.component.html',
  styleUrl: './workshop-item-card.component.scss',
})
export class WorkshopItemCardComponent {
  @Input('title') title: string = 'The Spooky Manor [Old Version]';
  @Input('assetsName') assetsName: 'spooky_manor_old' = 'spooky_manor_old';

  public readonly thumbPath: string;

  constructor() {
    this.thumbPath = `assets/projects/${this.assetsName}/${this.assetsName}_thumb.jpg`;
  }
}
