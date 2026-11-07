# Data sources and licences

The plugin's code is under the GPL-3.0 (see `LICENSE`). The data files it
downloads or ships come from the sources below.

## poetry-notebook-base.json.gz (themes and rare words)

- **Roget's Thesaurus of English Words and Phrases**, 1911 edition, by
  Peter Mark Roget — public domain (Project Gutenberg eBook #22). One theme
  per Roget category; the words, their order and the rare-word selection
  come from it.
- **WordNet 3.0**, Princeton University — every short definition ("note")
  comes from WordNet. Its licence requires the notice below on all copies.
- Word frequencies from the `wordfreq` library were used only to choose
  which words to keep (common words for theme triggers, rare words for the
  Random pool); no frequency data is redistributed.
- Offensive words were filtered out with WordNet's usage domains and the
  "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (used as a
  filter only, not redistributed).

### WordNet licence

```
WordNet Release 3.0

This software and database is being provided to you, the LICENSEE, by  
Princeton University under the following license.  By obtaining, using  
and/or copying this software and database, you agree that you have  
read, understood, and will comply with these terms and conditions.:  
  
Permission to use, copy, modify and distribute this software and  
database and its documentation for any purpose and without fee or  
royalty is hereby granted, provided that you agree to comply with  
the following copyright notice and statements, including the disclaimer,  
and that the same appear on ALL copies of the software, database and  
documentation, including modifications that you make for internal  
use or for distribution.  
  
WordNet 3.0 Copyright 2006 by Princeton University.  All rights reserved.  
  
THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON  
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR  
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON  
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-  
ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE  
OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT  
INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR  
OTHER RIGHTS.  
  
The name of Princeton University or Princeton may not be used in  
advertising or publicity pertaining to distribution of the software  
and/or database.  Title to copyright in this software, database and  
any associated documentation shall at all times remain with  
Princeton University and LICENSEE agrees to preserve same.  
```

## cmudict.dict.gz (CMUdict)

The Carnegie Mellon Pronouncing Dictionary — https://github.com/cmusphinx/cmudict.
Free to use for research and commercial purposes (BSD-style licence; see
the LICENSE file of that repository). Attached to each release unchanged,
only gzipped.
