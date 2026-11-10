# The brain: one EC2 host that will run prod's Postgres and API (#565). The
# defaults below keep it inert: with an empty brain_pg_image_tag there is no
# instance, no data volume and no Elastic IP (brain_instance.tf), so none of it
# costs anything. Guard: tests/guards.tftest.hcl (brain_is_absent_by_default).

variable "brain_serving" {
  description = "Whether the brain may start the API: sets the instance tag `brain-serving`, which the host reads from instance metadata. Off until the cutover."
  type        = bool
  default     = false
}

variable "brain_cpu_credits" {
  description = "CPU credit mode of the brain's instance: unlimited (the default: never throttled; credits spent beyond the baseline are billed, at most about US$47 a month on a t4g.small and US$53 on a t4g.micro with both cores pinned all month, and brain_cpu_surplus_credits_charged alarms on any charge) or standard (throttled to the baseline at zero credits; brain_cpu_credits_low alarms)."
  type        = string
  default     = "unlimited"

  validation {
    condition     = contains(["standard", "unlimited"], var.brain_cpu_credits)
    error_message = "brain_cpu_credits must be standard or unlimited."
  }
}

variable "brain_instance_type" {
  description = "Instance type of the brain: arm64, and one of the types brain_instance.tf knows Postgres memory settings for."
  type        = string
  default     = "t4g.small"

  validation {
    condition     = contains(keys(local.brain_pg_memory), var.brain_instance_type)
    error_message = "brain_instance_type must be a key of local.brain_pg_memory (brain_instance.tf): add its Postgres memory settings there first."
  }
}

variable "brain_pg_image_tag" {
  description = "Immutable tag of the logjam-brain-postgres image the brain runs. Empty means no instance."
  type        = string
  default     = ""
}

variable "brain_bootstrap" {
  description = "Sets the instance tag `brain-bootstrap`: 1 lets the host's first boot run initdb on a blank data volume. Leave false; set it for the one apply that creates the database from nothing, then set it back (an in-place tag change). A blank volume with backups in the repository restores whatever this says."
  type        = bool
  default     = false
}

# One entry per data volume ever made. Losing the disk is recovered by a change
# that adds the next key and makes it current (boot restores into it); the old
# volume stays, detached, until a later change drops its entry with a `removed`
# block. Losing the zone is the same change with another `az`. Volumes are never
# replaced in place: prevent_destroy makes a changed `az` an error.
#
# Bad data is the same change with one more field on the new entry, restore_to:
# the new volume restores to that time and not to the latest state. It lives on
# the entry so it can never apply to a later volume (the next loss adds a key
# without it and gets the latest state), and a boot only restores into a blank
# disk, so leaving it on the entry is harmless. The old volume keeps the data as
# it was before the rewind: making it current again is the undo.
variable "brain_data_volumes" {
  description = "The brain's data volumes by key: availability zone (one of the two subnets in network.tf), size in GB, and optionally restore_to, a time with a UTC offset (2026-11-20T03:15:00+11:00) the volume's first boot restores to instead of the latest state."
  type        = map(object({ az = string, size_gb = number, restore_to = optional(string, "") }))
  default     = { "1" = { az = "ap-southeast-2a", size_gb = 20 } }

  validation {
    condition     = alltrue([for v in values(var.brain_data_volumes) : contains(["ap-southeast-2a", "ap-southeast-2b"], v.az)])
    error_message = "A data volume's az must be ap-southeast-2a or ap-southeast-2b: the zones of the subnets network.tf names."
  }

  validation {
    condition = alltrue([
      for v in values(var.brain_data_volumes) : v.restore_to == "" || (
        can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$", v.restore_to)) &&
        can(timecmp(v.restore_to, "2000-01-01T00:00:00Z"))
      )
    ])
    error_message = "A data volume's restore_to must be a real time with a UTC offset, like 2026-11-20T03:15:00+11:00 (Z for UTC). A time without an offset is refused: it would be read in whatever zone the host happens to use."
  }
}

variable "brain_data_volume_current" {
  description = "Key of the entry in brain_data_volumes that is attached to the instance, and whose zone the instance runs in."
  type        = string
  default     = "1"

  validation {
    condition     = contains(keys(var.brain_data_volumes), var.brain_data_volume_current)
    error_message = "brain_data_volume_current must be a key of brain_data_volumes."
  }
}

variable "brain_root_volume_gb" {
  description = "Size of the brain's root disk in GB. Disposable: the data volume holds everything that matters."
  type        = number
  default     = 16
}
