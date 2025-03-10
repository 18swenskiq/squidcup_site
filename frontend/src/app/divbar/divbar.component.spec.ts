import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DivbarComponent } from './divbar.component';

describe('DivbarComponent', () => {
  let component: DivbarComponent;
  let fixture: ComponentFixture<DivbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DivbarComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(DivbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
