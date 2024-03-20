#!/bin/bash

if [ -z "$SKARGO_PROFILE" ]; then
    SKARGO_PROFILE=dev
fi

pass() { printf "%-44s OK\n" "$1:"; }
fail() { printf "%-44s FAILED\n" "$1:"; }

SKDB="skargo run -q --profile $SKARGO_PROFILE -- "
LC_TIME=C

export SKDB LC_TIME

mkdir -p "test/dates"
rm -f "test/dates/*.diff"

if [ ! -f "test/dates/valid_date_list3.txt" ]; then
  for y in {1900..2100}; do
      for m in {1..12}; do
          if [[ "$m" -lt "10" ]];
          then
              mm="0$m"
          else
              mm="$m"
          fi
          for d in {1..31}; do
              if [[ "$d" -lt "10" ]];
              then
                  dd="0$d"
              else
                  dd="$d"
              fi
              date -d "$y-$mm-$dd"  +"%Y-%m-%d" &> /dev/null
              if [ $? -eq 0 ]
              then
                echo "$y-$mm-$dd"
              fi
          done
      done
  done > "test/dates/valid_date_list3.txt"
fi

if [ ! -f "test/dates/valid_date_list.txt" ]; then
  while IFS="-" read -r y mm dd
  do
    if ((y >= 1990 && y <= 2020)); then
      echo "$y-$mm-$dd"
    fi
  done < "test/dates/valid_date_list3.txt" > "test/dates/valid_date_list.txt"
fi


if [ ! -f "test/dates/valid_date_list2.txt" ]; then
  while IFS="-" read -r y mm dd
  do
    if ((y >= 1995 && y <= 2005)); then
      echo "$y-$mm-$dd"
    fi
  done < "test/dates/valid_date_list.txt" > "test/dates/valid_date_list2.txt"
fi

if [ ! -f "test/dates/days.sql" ]; then
  while IFS="" read -r d || [ -n "$d" ]
  do
    echo "select strftime('%Y-%m-%d %H:%M:%S', '$d');"
  done < "test/dates/valid_date_list3.txt" > "test/dates/days.sql"
fi

if [ ! -f "test/dates/weeknumbers.sql" ]; then
  while IFS="" read -r d || [ -n "$d" ]
  do
    echo "select strftime('%Y-%m-%d: %W', '$d');"
  done < "test/dates/valid_date_list.txt" > "test/dates/weeknumbers.sql"
fi

if [ ! -f "test/dates/plus_one_day.sql" ]; then
  while IFS="" read -r d || [ -n "$d" ]
  do
    echo "select strftime('%Y-%m-%d %H:%M:%S', '$d', '+1 day');"
  done < "test/dates/valid_date_list.txt" > "test/dates/plus_one_day.sql"
fi

if [ ! -f "test/dates/minus_one_day.sql" ]; then
  while IFS="" read -r d || [ -n "$d" ]
  do
    echo "select strftime('%Y-%m-%d %H:%M:%S', '$d', '-1 day');"
  done < "test/dates/valid_date_list.txt" > "test/dates/minus_one_day.sql"
fi

run_test () {
  cat $1 | $SKDB --always-allow-joins | sort > "$1.out";
  cat $1 | sqlite3 | sort > "$1.res"
  diff=$(diff -u "$1.out" "$1.res")
  if [ "$diff" == "" ]; then
      rm -f "$1.out"
      rm -f "$1.res"
      pass "$2"
  else
      echo $diff > "$1.diff"
      fail "$2"
      exit 2
  fi
}

run_l_date () {
  echo "select strftime('$2', '$3', 'islocal');" | $SKDB >> "$1.out";
  date -d "$3"  +"$2" >> "$1.res";
}

run_date () {
  echo "select strftime('$2', '$3');" | $SKDB >> "$1.out";
  date -u -d "$3" +"$2" >> "$1.res";
}

run_date_test () {
  rm -f "$1.out"
  rm -f "$1.res"
  run_date $1 "A: %A" "$3"
  run_date $1 "a: %a" "$3"
  run_date $1 "B: %B" "$3"
  run_date $1 "b: %b" "$3"
  run_date $1 "C: %C" "$3"
  run_date $1 "D: %D" "$3"
  run_date $1 "d: %d" "$3"
  run_date $1 "e: %e" "$3"
  run_date $1 "F: %F" "$3"
  run_date $1 "H: %H" "$3"
  run_date $1 "h: %h" "$3"
  run_date $1 "I: %I" "$3"
  run_date $1 "j: %j" "$3"
  run_date $1 "k: %k" "$3"
  run_date $1 "L: %L" "$3"
  run_date $1 "l: %l" "$3"
  run_date $1 "M: %M" "$3"
  run_date $1 "m: %m" "$3"
  run_date $1 "n: line1%nn: line2" "$3"
  run_date $1 "P: %P" "$3"
  run_date $1 "p: %p" "$3"
  run_date $1 "Q: %Q" "$3"
  run_date $1 "R: %R" "$3"
  run_date $1 "S: %S" "$3"
  run_date $1 "T: %T" "$3"
  run_date $1 "t: a%tb" "$3"
  run_date $1 "U: %U" "$3"
  run_date $1 "u: %u" "$3"
  run_date $1 "V: %V" "$3"
  run_date $1 "W: %W" "$3"
  run_date $1 "w: %w" "$3"
  run_date $1 "Y: %Y" "$3"
  run_date $1 "y: %y" "$3"
  run_l_date $1 "z: %z" "$3"
  run_l_date $1 "Z: %Z" "$3"
  diff=$(diff -u "$1.out" "$1.res")
  if [ "$diff" == "" ]; then
      rm -f "$1.out"
      rm -f "$1.res"
      pass "$2"
  else
      echo $diff > "$1.diff"
      fail "$2"
      exit 2
  fi
}

##############################################################################
# testing weeknumbers #
##############################################################################

##############################################################################
# testing +1 day #
##############################################################################

##############################################################################
# testing modifiers with hours #
##############################################################################

run_hour_test () {
    for i in {"23:00","23:30","00:00","00:30","01:00"}; do
        tmp=${1/+/plus}
        suffix=${tmp// /_}_${i//:/_}
	if [ ! -f "test/dates/hour_$suffix.sql" ]; then
          while IFS="" read -r d || [ -n "$d" ]
          do
            echo "select strftime('%Y-%m-%d %H:%M:%S', '$d $i', '$1');"
          done < "test/dates/valid_date_list2.txt" > "test/dates/hour_$suffix.sql"
	fi
        run_test test/dates/hour_$suffix.sql "$1 (at hour $i)"
    done
}

run_hour_test2 () {
    for i in {"23:00","23:30","00:00","00:30","01:00"}; do
        tmp=${1/-/minus}
        suffix=${tmp// /_}_${i//:/_}
	if [ ! -f "test/dates/hour_$suffix.sql" ]; then
          while IFS="" read -r d || [ -n "$d" ]
          do
            echo "select strftime('%Y-%m-%d %H:%M:%S', '$d $i', '$1');"
          done < "test/dates/valid_date_list2.txt" > "test/dates/hour_$suffix.sql"
	fi
        run_test test/dates/hour_$suffix.sql "$1 (at hour $i)"
    done
}

##############################################################################
# testing days #
##############################################################################

##############################################################################
# modify time #
##############################################################################

run_modify_time () {
  date=$(date +"%Y-%m-%d %H:%M:%S")
  if [ ! -f "test/dates/$1.sql" ]; then
    for i in {1..20500}; do
      echo "select strftime('%Y-%m-%d %H:%M:%S', '$date',  '$2$i $3');"
    done  > "test/dates/$1.sql"
  fi
  run_test "test/dates/$1.sql" $1
}

##############################################################################
# testing epoch #
##############################################################################

run_epoch_utc_test () {
  rm -f "$1.out"
  rm -f "$1.res"
  while IFS="" read -r d || [ -n "$d" ]
  do
    run_date "$1" "%Y-%m-%d %H:%M:%S => %s" "$d"
  done < "test/dates/valid_date_list2.txt"

  diff=$(diff -u "$1.out" "$1.res")
  if [ "$diff" == "" ]; then
      rm -f "$1.out"
      rm -f "$1.res"
      pass "$2"
  else
      echo $diff > "$1.diff";
      fail "$2"
      exit 2
  fi
}

run_epoch_locale_test () {
  rm -f "$1.out"
  rm -f "$1.res"
  while IFS="" read -r d || [ -n "$d" ]
  do
    run_l_date "$1" "%Y-%m-%d %H:%M:%S => %s" "$d"
  done < "test/dates/valid_date_list2.txt"

  diff=$(diff -u "$1.out" "$1.res")
  if [ "$diff" == "" ]; then
      rm -f "$1.out"
      rm -f "$1.res"
      pass "$2"
  else
      echo $diff > "$1.diff";
      fail "$2"
      exit 2
  fi
}

# Make functions defined in this file visible to parallel's sub-shells
export -f pass fail run_date run_l_date run_hour_test run_hour_test2 run_date_test run_test run_modify_time

run_hour_test2 "-365 day"
run_hour_test2 "-366 day"

seq 0 6 | parallel 'run_hour_test "weekday {}"'
seq 0 13 | parallel 'run_hour_test "+{} month" ; run_hour_test2 "-{} month"'
seq 0 32 | parallel 'run_hour_test "+{} day" ; run_hour_test2 "-{} day"'

parallel -n3 run_date_test ::: \
	 test/dates/formats_1.sql "formats 1" "2023-09-18 13:26:54" \
	 test/dates/formats_2.sql "formats 2" "2021-01-27 08:52:03" \
	 test/dates/formats_3.sql "formats 3" "1985-01-01 00:00:00" \
	 test/dates/formats_4.sql "formats 4" "1963-12-31 00:00:00"


parallel -n2 run_test ::: \
	 test/dates/weeknumbers.sql "weeknumbers" \
	 test/dates/plus_one_day.sql "+1 day (at hour 00:00)" \
	 test/dates/minus_one_day.sql "-1 day (at hour 00:00)" \
	 test/dates/days.sql "days"

parallel -n3 run_modify_time ::: \
	 "add_hours" "+" "hour" \
	 "minus_hours" "-" "hour" \
	 "add_minutes" "+" "minute" \
	 "minus_minute" "-" "minute"

run_epoch_utc_test "test/dates/epoch_utc.sql" "epoch_utc"
run_epoch_locale_test "test/dates/epoch_locale.sql" "epoch_locale"
