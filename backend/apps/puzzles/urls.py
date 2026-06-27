from django.urls import path

from .views import (
    NextPuzzleView,
    PuzzleDetailView,
    PuzzleMapView,
    PuzzleProgressView,
    PuzzleStatsView,
)

app_name = "puzzles"

urlpatterns = [
    path("next/", NextPuzzleView.as_view(), name="next"),
    path("map/", PuzzleMapView.as_view(), name="map"),
    path("stats/", PuzzleStatsView.as_view(), name="stats"),
    path("<int:pk>/", PuzzleDetailView.as_view(), name="detail"),
    path("<int:pk>/progress/", PuzzleProgressView.as_view(), name="progress"),
]
