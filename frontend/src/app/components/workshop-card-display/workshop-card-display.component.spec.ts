import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkshopCardDisplayComponent } from './workshop-card-display.component';

describe('WorkshopCardDisplayComponent', () => {
  let component: WorkshopCardDisplayComponent;
  let fixture: ComponentFixture<WorkshopCardDisplayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkshopCardDisplayComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(WorkshopCardDisplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
