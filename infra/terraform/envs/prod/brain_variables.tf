# The brain: one EC2 host that will run prod's Postgres and API
# (private/plans design, issue #565). This first slice is inert: buckets, an
# image repository, a role, log groups and a security group, and no instance.
# The defaults below keep it that way; the next change reads the last three.

variable "brain_serving" {
  description = "Whether the brain may start the API: the body of the `serving` object in the signals bucket. Off until the cutover."
  type        = bool
  default     = false
}

variable "brain_cpu_credits" {
  description = "CPU credit mode of the brain's instance (standard or unlimited). Unused until the instance exists."
  type        = string
  default     = "standard"
}

variable "brain_instance_type" {
  description = "Instance type of the brain. Unused until the instance exists."
  type        = string
  default     = "t4g.small"
}

variable "brain_pg_image_tag" {
  description = "Immutable tag of the logjam-brain-postgres image the brain runs. Empty means no instance."
  type        = string
  default     = ""
}
