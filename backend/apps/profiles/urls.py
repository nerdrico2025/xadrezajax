from django.urls import path

from .views import (
    CreateProfileView,
    MyProfileView,
    PlayerProfileView,
    PromoteToAdminView,
    WhoAmIView,
    ProtectedGameExampleView,
)

app_name = "profiles"

urlpatterns = [
    path("", CreateProfileView.as_view(), name="profile-create"),
    path("me/", MyProfileView.as_view(), name="profile-me"),
    path("player/", PlayerProfileView.as_view(), name="player-profile"),
    path("promote/<int:user_id>/", PromoteToAdminView.as_view(), name="promote-admin"),
    path("whoami/", WhoAmIView.as_view(), name="whoami"),
    path("game-example/", ProtectedGameExampleView.as_view(), name="game-example"),
]
