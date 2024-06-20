# SKStore: a generic framework for reactive programming

SKStore is a store made of collections called `directories`. Each
directory contains entries associating values to a key. The keys can
be of any type as long as they extend the class `SKStore.Key`, the
values can be of any type as long as they extend the class
`SKStore.File`. The APIs available for `SKStore` can be found in
`Context.sk` and `Handle.sk`.

## DirName

Each directory (or collection) has a name, the name is defined with a
slash separated path "/of/this/form/". The way to create a DirName is
by using the primitive `DirName::create`. A directory name must start
and finish with a slash, if it doesn't, an exception is thrown. The
names are not used directly when manipulating directories, however,
they come in handy when trying to debug the state that the system is
in. One can navigate all the reactive values using familiar primitives
(such as cd, ls etc ...).

## Input directories

Input directories are directories that can be modified by the outside
world. To create one, you must use the primitve `mkdir`, the type of
the key and of the values must be speficied:

```
myInputDirectory =
  context.mkdir(Type1::keyType, Type2::type, "/myInput/Name/")
```

Note that the fields "keyType" and "type" are automatically defined
when one extends `SKStore.Key` and `SKStore.File` respectively.

Once a directory is created, one can modify it (add/remove):

```
myInputDirectory.writeArray(context, myKey, Array[myValue])
```

Removing an element just consists in writing an empty array (also
called a "tomb"). There is no sematic difference between an empty
array and not entry, since SKStore returns an empty array when trying
to access a missing entry.

Tombs are useful to handle concurrency and to synchronize directories
with the outside world. They are collected automatically by the
system.

## Eager directory

An eager directory is a directory defined as the result of a "map"
over one or multiple directories. For example:

```
sumDir = myDirOfIntegers.map(
  IID::keyType,
  IntFile::type,
  context,
  "/result/",
  (context, writer, key, fileIterator) ~> {
    sum = 0;
    for(intFile in fileIterator) {
      sum = sum + intFile.value
    };
    writer.set(key, IntFile(sum));
  }
)
```

In this example, we map over a directory of type `IntFile` and produce
the sum for each entry. Once this map is defined, a link has been
created between `myDirOfIntegers` and `sumDir`. Every time
`myDirsOfIntegers` changes, the directory `sumDir` will be updated
accordingly.


### Direct access

Sometimes, mapping over directories is not what we need, there are
cases where the value we are interested in is determined at
runtime. SKStore gracefully handles this case, by allowing one to
directly lookup values in any available directory. For example, let's
imagine a directory that is made of names, and those names need to be
looked up in another directory. We would program it by using the
primitive `getArray`, which can be used on any SKStore directory:

```
sumDir = myDirOfNames.map(
  SID::keyType,
  StringFile::type,
  context,
  "/result2/",
  (context, writer, key, fileIterator) ~> {
    values = mutable Vector[];
    for(file in fileIterator) {
      value = myOtherDirectory.getArray(SID::create(file.value));
      values.push(value);
    };
    result = // .. do something with values ...
    writer.set(key, result);
  }
)
```

### Subdirectories

It is possible to map over a directory inside of a mapper
function. The resulting directory can then be stored in a file, and
made accessible to the rest of the system, because directories are
also values.

You can also create inputDirectories within a mapper, but this is a
very advanced feature that we don't recommend using for beginners. The
problem is that these kind of directories will be "cleaned up" if the
key that created the directory was removed. When that is the case, all
the data that was in that input directory gets wiped out, which can
lead to data loss. To keep things safe, we recommend you only create
input directories at toplevel.

## Lazy directories

A lazy directory works just like a cache, except that the cache
invalidation is handled automatically by SKStore. To define one, use
the primitive `LHandle::create`:

```
myLazyDir = LHandle::create(
  IID::keyType,
  IntFile::type,
  context,
  "/myDirName/",
  (context, self, key) ~> {
    Array[/* some value */]
  }
)
```

Just like in any other cache, the values are automatically evicted if
they are not used often enough. The cache eviction policy is
programmable (cf `Handle.sk`). Note that Lazy directories are very
handy to handle recursive definitions because they pass around a
reference to themselves (the parameter `self` of the closure above).

# Guarantees

SKStore is a simple yet powerful API to define reactive systems. It
provides the following guarantees:

- The system is transactional. Either the transaction succeeded and
  the whole system updated, or the transaction failed and nothing
  changed. There is no such thing as "half" updates.

- The system is concurrent, multiple readers and multiple writers can
  interact with SKStore at the same time, without blocking each-other
  (except at commit time).

- The system is automatically garbage collected.

- The garbage collection time is function of the size of the update,
  not of the size of the heap. This is a very important distinction,
  because without this property, the system would experience long
  pauses when dealing with large collections.

- SKStore both work in-memory or on disk.

- It is possible very quickly retrieve a diff of any eager directory
  between the present and any point in the past.

- It is possible to observe changes on any directory (and quickly
  recover if the connection drops).
