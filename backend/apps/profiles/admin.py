from django.contrib import admin

from .models import Profile, PlayerProfile, AdminProfile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "nickname", "created_at", "updated_at"]
    search_fields = ["user__email", "user__full_name", "nickname"]
    readonly_fields = ["created_at", "updated_at"]
    raw_id_fields = ["user"]

@admin.register(PlayerProfile)
class PlayerProfileAdmin(admin.ModelAdmin):
    list_display = ["profile", "rating", "games_played", "created_at"]
    search_fields = ["profile__user__email", "profile__nickname"]
    readonly_fields = ["created_at", "updated_at"]
    raw_id_fields = ["profile"]

@admin.register(AdminProfile)
class AdminProfileAdmin(admin.ModelAdmin):
    list_display = ["profile", "promoted_by", "promoted_at"]
    search_fields = ["profile__user__email", "promoted_by__email"]
    readonly_fields = ["promoted_at"]
    raw_id_fields = ["profile", "promoted_by"]
