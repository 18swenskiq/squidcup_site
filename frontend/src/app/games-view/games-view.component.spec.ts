import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GamesViewComponent } from './games-view.component';

describe('GamesViewComponent', () => {
  let component: GamesViewComponent;
  let fixture: ComponentFixture<GamesViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GamesViewComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(GamesViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
