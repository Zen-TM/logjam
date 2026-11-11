# The brain's settings: the one file prod's Terraform and the deploy workflows
# both read (infra/scripts/brain-setting.sh reads the one-line settings; the
# defaults in brain_variables.tf stay as they are, empty and off). A change is
# a one-line change that merges and applies like any other prod change. Never
# set these with -var or a TF_VAR_: the workflows would not see them. This is
# the only *.tfvars file in this directory (guard:
# brain_settings_are_one_file_and_read_by_the_workflows).

# The image of infra/brain/postgres. Non-empty creates the instance, its data
# volume and address, the watchdog and the drill. Required by brain_serving.
brain_pg_image_tag = "6c5e4cc1cdbf975b264ad12762b705b803b48af8"

# True for the one apply that creates the database from nothing, on a blank
# volume with no backup in the repository; false again right after. A blank
# volume with a backup restores whatever this says.
brain_bootstrap = false

# True when the brain's API runs, and the deploy and rollback workflows wait for
# the release to be live. The API's background sweeps delete media that has no
# row in their own database: never turn it on for a brain rebuilt from backups
# until its data is checked.
brain_serving = true

# t4g.micro was chosen after the rehearsal. Moving up a size (t4g.small) is
# this one line and about two minutes of downtime.
brain_instance_type = "t4g.micro"

# One entry per data volume ever made. Losing the disk adds the next key and
# makes it current; a rewind past bad data adds restore_to to the new entry (a
# time with a UTC offset). See brain_variables.tf.
brain_data_volumes = {
  "1" = { az = "ap-southeast-2a", size_gb = 20 }
}
brain_data_volume_current = "1"
