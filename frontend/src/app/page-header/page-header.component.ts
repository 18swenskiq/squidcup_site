import { Component, Input } from '@angular/core';
import { DivbarComponent } from '../divbar/divbar.component';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [DivbarComponent],
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.scss',
})
export class PageHeaderComponent {
  @Input('title') pageTitle: string = 'NO TITLE DEFINED';
  @Input('descriptionParagraphs') descriptionParagraphs: string[] = [
    'Description 1',
    'Description 2',
  ];
}
